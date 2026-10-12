#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { LineageWorkspace, receiveBundle, verifyBundle } from "./store.mjs";
import { startServer } from "./server.mjs";
import { serveStdio } from "./protocol.mjs";
import { LineageClient } from "./client.mjs";

const HELP = [
  "OpenLineage operations workspace",
  "",
  "  scf-lineage init --workspace DIR [--title TITLE]",
  "  scf-lineage serve --workspace DIR [--host 127.0.0.1] [--port 8767] [--token-file FILE]",
  "  scf-lineage import --workspace DIR --input EVENTS [--name NAME] [--source URL] --operation-id ID [--revision N]",
  "  scf-lineage status --workspace DIR [--edition ID]",
  "  scf-lineage action ACTION --workspace DIR --input ARGUMENTS.json",
  "  scf-lineage action ACTION --url URL --input ARGUMENTS.json [--token-file FILE]",
  "  scf-lineage edition --workspace DIR --title TITLE --operation-id ID [--revision N]",
  "  scf-lineage attach --workspace DIR --input RESULT --binding BINDING.json",
  "  scf-lineage export --workspace DIR --out FILE",
  "  scf-lineage report --workspace DIR --format json|csv|html --out FILE [--edition ID]",
  "  scf-lineage source --workspace DIR --id SHA256 --out FILE",
  "  scf-lineage verify --input PACKAGE",
  "  scf-lineage receive --input PACKAGE --out NEW_DIRECTORY",
  "  scf-lineage download --url URL --id EXPORT_SHA256 --out FILE [--token-file FILE]",
  "  scf-lineage mcp --workspace DIR",
  "  scf-lineage recover-lock --workspace DIR --id ORIGINAL_LOCK_ID",
  "",
  "The default server listens only on this computer. Original event files and result",
  "bytes remain in the selected private workspace. Exports include the editable",
  "application. Receiving preserves original workspace, event, edition and review IDs.",
  "Use the same operation ID and original arguments to recover an interrupted mutation.",
  "See README.md for the complete operator, producer, SDK and receiving workflow."
].join("\n");
function parse(args) {
  const result = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (Object.hasOwn(result, key)) throw new Error("Repeated option --" + key);
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) throw new Error("Missing value for --" + key);
    result[key] = args[++i];
  }
  return { result, positional };
}
function check(options, allowed) { for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error("Unknown option --" + key); }
function need(value, name) { if (!value) throw new Error(name + " is required"); return value; }
async function writeNew(path, bytes) { await fs.writeFile(resolve(need(path, "--out")), bytes, { flag: "wx", mode: 0o600 }); }
async function readJson(path) { return JSON.parse(await fs.readFile(need(path, "--input"), "utf8")); }
async function token(options) { return options["token-file"] ? (await fs.readFile(options["token-file"], "utf8")).trim() : null; }
const print = value => console.log(JSON.stringify(value, null, 2));
export async function main(argv = process.argv.slice(2)) {
  const args = [...argv], command = args.shift();
  if (!command || ["help", "--help", "-h"].includes(command)) { console.log(HELP); return 0; }
  const { result: options, positional } = parse(args);
  if (command === "verify") {
    check(options, ["input"]);
    const value = verifyBundle(await fs.readFile(need(options.input, "--input")));
    print({ workspaceId: value.state.workspaceId, revision: value.state.revision, packageSha256: value.packageSha256, objects: value.objects.size, applicationFiles: value.application.size });
    return 0;
  }
  if (command === "receive") {
    check(options, ["input", "out"]);
    print(await receiveBundle(await fs.readFile(need(options.input, "--input")), need(options.out, "--out"))); return 0;
  }
  if (command === "download") {
    check(options, ["url", "id", "out", "token-file"]);
    const client = new LineageClient(need(options.url, "--url"), { token: await token(options) });
    print(await client.downloadExport(need(options.id, "--id"), need(options.out, "--out"))); return 0;
  }
  if (command === "action" && options.url) {
    check(options, ["url", "input", "token-file"]);
    const client = new LineageClient(options.url, { token: await token(options) });
    print(await client.action(need(positional[0], "ACTION"), options.input ? await readJson(options.input) : {})); return 0;
  }
  const workspace = new LineageWorkspace(need(options.workspace, "--workspace"));
  if (command === "init") {
    check(options, ["workspace", "title"]); print(await workspace.initialize(options.title)); return 0;
  }
  if (command === "serve") {
    check(options, ["workspace", "title", "host", "port", "token-file", "expected-workspace-id"]);
    const host = await startServer({ directory: options.workspace, title: options.title, host: options.host ?? "127.0.0.1", port: options.port === undefined ? 8767 : Number(options.port), token: await token(options), expectedWorkspaceId: options["expected-workspace-id"] ?? null });
    console.log(JSON.stringify(host.identity));
    let closing = false;
    const close = () => { if (closing) return; closing = true; host.close().then(() => { process.exitCode = 0; }, error => { console.error(error.message); process.exitCode = 1; }); };
    process.once("SIGINT", close); process.once("SIGTERM", close);
    return 0;
  }
  if (command === "recover-lock") {
    check(options, ["workspace", "id"]); print(await workspace.recoverLock(need(options.id, "--id"))); return 0;
  }
  await workspace.read();
  if (command === "status") {
    check(options, ["workspace", "edition"]); print(await workspace.view({ edition: options.edition ?? null })); return 0;
  }
  if (command === "import") {
    check(options, ["workspace", "input", "name", "source", "operation-id", "revision"]);
    const bytes = await fs.readFile(need(options.input, "--input"));
    const revision = options.revision === undefined ? (await workspace.read()).revision : Number(options.revision);
    print(await workspace.importSource({ bytes, name: options.name ?? options.input.split(/[\\/]/).at(-1), sourceUrl: options.source ?? "", operationId: need(options["operation-id"], "--operation-id"), expectedRevision: revision })); return 0;
  }
  if (command === "edition") {
    check(options, ["workspace", "title", "description", "operation-id", "revision"]);
    print(await workspace.saveEdition({ title: need(options.title, "--title"), description: options.description ?? "", operationId: need(options["operation-id"], "--operation-id"), expectedRevision: options.revision === undefined ? (await workspace.read()).revision : Number(options.revision) })); return 0;
  }
  if (command === "attach") {
    check(options, ["workspace", "input", "binding"]);
    const binding = await readJson(need(options.binding, "--binding"));
    print(await workspace.attachResult({ ...binding, bytes: await fs.readFile(need(options.input, "--input")) })); return 0;
  }
  if (command === "action") {
    check(options, ["workspace", "input"]);
    print(await workspace.dispatch(need(positional[0], "ACTION"), options.input ? await readJson(options.input) : {})); return 0;
  }
  if (command === "source") {
    check(options, ["workspace", "id", "out"]); const bytes = await workspace.readObject(need(options.id, "--id"));
    await writeNew(options.out, bytes); print({ id: options.id, bytes: bytes.length, out: resolve(options.out) }); return 0;
  }
  if (command === "report") {
    check(options, ["workspace", "format", "out", "edition"]);
    if (!["json", "csv", "html"].includes(options.format)) throw new Error("--format must be json, csv or html");
    const output = await workspace.dispatch("report.read", { format: options.format, edition: options.edition ?? null });
    await writeNew(options.out, output.text); print({ out: resolve(options.out), mediaType: output.mediaType }); return 0;
  }
  if (command === "export") {
    check(options, ["workspace", "out"]); const info = await workspace.exportBundle();
    const bytes = await fs.readFile(resolve(options.workspace, "exports", info.id + ".json"));
    await writeNew(options.out, bytes); print({ ...info, out: resolve(options.out) }); return 0;
  }
  if (command === "mcp") {
    check(options, ["workspace"]); await serveStdio(workspace); return 0;
  }
  throw new Error("Unknown command. Use --help.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { if (Number.isInteger(code)) process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.message, status: error.status ?? 1, ...(error.details ? { details: error.details } : {}) }));
    process.exitCode = 1;
  });
