#!/usr/bin/env node
// Copyright TokenJunkieLabs. Inspect or recover verified files without running their contents.
import { open, mkdir, lstat, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, basename, join, sep } from "node:path";
import { createSourceBankToolkit, DEFAULT_LIMITS } from "./source_bank.mjs";

const usage = [
  "Usage:",
  "  node source_tools/source_bank_cli.mjs inspect INPUT [options]",
  "  node source_tools/source_bank_cli.mjs extract INPUT NEW_DIRECTORY [options]",
  "",
  "Inputs: ordinary ZIP, gzip or plain-LZMA2 XZ source-bank JSON,",
  "native Slack Canvas response JSON,",
  "or exported Markdown with one envelope or ordered application-source packets.",
  "",
  "Options:",
  "  --sha256 HEX            Require the decoded input archive identity",
  "  --base64                Decode plain base64 input before format detection",
  "  --member RELATIVE_PATH  Extract one exact verified member",
  "  --max-input-bytes N     Default " + DEFAULT_LIMITS.maxInputBytes,
  "  --max-output-bytes N    Default " + DEFAULT_LIMITS.maxOutputBytes,
  "  --max-member-bytes N    Default " + DEFAULT_LIMITS.maxMemberBytes,
  "  --max-members N         Default " + DEFAULT_LIMITS.maxMembers,
  "  --max-gzip-members N    Default " + DEFAULT_LIMITS.maxGzipMembers,
  "",
  "Extraction creates NEW_DIRECTORY exclusively and preserves the exact input",
  "and full inventory under .source-bank-recovery. Existing paths are never overwritten.",
  "All archive contents are verified before the first output file is created."
].join("\n");

function parse(argv) {
  if (argv.includes("--help") || argv.length === 0) return { help: true };
  const command = argv.shift(), positional = [], options = {}, limits = {};
  if (!["inspect", "extract"].includes(command)) throw new Error("Choose inspect or extract");
  const limitNames = {
    "--max-input-bytes": "maxInputBytes", "--max-output-bytes": "maxOutputBytes",
    "--max-member-bytes": "maxMemberBytes", "--max-members": "maxMembers",
    "--max-gzip-members": "maxGzipMembers"
  };
  const seen = new Set();
  while (argv.length) {
    const arg = argv.shift();
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    if (seen.has(arg)) throw new Error("Repeated option " + arg);
    seen.add(arg);
    if (arg === "--base64") { options.base64 = true; continue; }
    if (arg === "--sha256" || arg === "--member" || limitNames[arg]) {
      const value = argv.shift();
      if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
      if (limitNames[arg]) limits[limitNames[arg]] = Number(value);
      else options[arg === "--sha256" ? "expectedSha256" : "member"] = value;
    } else throw new Error("Unknown option " + arg);
  }
  if (positional.length !== (command === "inspect" ? 1 : 2)) throw new Error("Wrong number of paths");
  if (command === "inspect" && options.member) throw new Error("--member applies to extract");
  return { command, input: positional[0], output: positional[1], options, limits };
}

async function readBounded(path, limit) {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error("Input must be a regular file within max-input-bytes");
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error("Input changed while reading");
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

async function ensureParents(root, relative) {
  let current = root;
  for (const part of relative.split("/").slice(0, -1)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current)
      throw new Error("Output parent changed or is a symlink: " + current);
  }
}

async function writeExclusive(root, relative, data) {
  await ensureParents(root, relative);
  const path = join(root, ...relative.split("/"));
  if (!path.startsWith(root + sep)) throw new Error("Output path escaped recovery directory");
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
                                  (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage + "\n"); return; }
  const toolkit = createSourceBankToolkit(args.limits);
  const original = await readBounded(resolve(args.input), toolkit.limits.maxInputBytes);
  const result = toolkit.decode(original, args.options);
  const inventory = { ...toolkit.inventory(result),
    originalInputBytes: original.length,
    originalInputSha256: createHash("sha256").update(original).digest("hex"),
    base64Input: Boolean(args.options.base64)
  };
  if (args.command === "inspect") {
    process.stdout.write(JSON.stringify(inventory, null, 2) + "\n"); return;
  }
  const requested = args.options.member;
  if (requested) toolkit.portablePath(requested);
  const files = requested ? result.files.filter(file => file.path === requested) : result.files;
  if (requested && files.length !== 1) throw new Error("Requested member is absent: " + requested);
  if (result.files.some(file => file.path.split("/")[0].toLowerCase() === ".source-bank-recovery"))
    throw new Error("Archive collides with reserved recovery metadata directory");
  const requestedRoot = resolve(args.output);
  const parent = await realpath(dirname(requestedRoot));
  const name = basename(requestedRoot);
  if (!name || name === "." || name === "..") throw new Error("Choose a new recovery directory");
  const output = join(parent, name);
  await mkdir(output, { mode: 0o700 });
  let complete = false;
  try {
    for (const file of files) await writeExclusive(output, file.path, file.data);
    await writeExclusive(output, ".source-bank-recovery/input", original);
    await writeExclusive(output, ".source-bank-recovery/inventory.json", Buffer.from(JSON.stringify({
      ...inventory, recoveredPaths: files.map(file => file.path),
      originalInputPath: resolve(args.input), extractedAt: new Date().toISOString(),
      fileMode: "0600; original executable flags remain recorded in the inventory"
    }, null, 2) + "\n"));
    complete = true;
  } finally {
    if (!complete) await rm(output, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify({
    output, memberCount: files.length, recoveredBytes: files.reduce((n, file) => n + file.bytes, 0),
    inputSha256: inventory.inputSha256, inventory: join(output, ".source-bank-recovery/inventory.json")
  }, null, 2) + "\n");
}

main().catch(error => { process.stderr.write("source-bank recovery: " + error.message + "\n"); process.exitCode = 1; });
