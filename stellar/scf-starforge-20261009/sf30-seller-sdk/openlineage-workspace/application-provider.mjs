// MIT. The original OpenLineage workspace in the maintained Applications lifecycle.
import { join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { inspectMerchantRuntime } from "../../sf46-release/runtime-package.mjs";
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup, applicationPrivateUrl } from "../../distribution/runtime-workspace/application-provider.mjs";
import { LineageWorkspace } from "./store.mjs";
import { digest } from "./model.mjs";

const ROOT = "stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/";
const STARTUP = "commons.openlineage.startup.v1";
function need(value, message) { if (!value) throw new Error(message); }
function argument(request, name, required = true) {
  const positions = request.args.flatMap((value, i) => value === name ? [i] : []);
  if (!positions.length && !required) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === "string", "The saved OpenLineage command selection changed.");
  return request.args[positions[0] + 1];
}
export async function prepareOpenLineageApplication(settings, { inputPath, runtimeDirectory }) {
  const selected = await inputPath(settings.workspaceDirectory, "directory", false, true);
  const runtime = await inspectMerchantRuntime(resolve(runtimeDirectory), { load: false, source: false });
  const native = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + "store.mjs")).href);
  const state = await new native.LineageWorkspace(selected.path).read();
  const inputs = [selected];
  for (const file of native.APPLICATION_FILES) inputs.push(await inputPath(join(runtime.sourceRoot, ROOT, file), "file"));
  const args = ["serve", "--workspace", selected.path, "--host", "127.0.0.1", "--expected-workspace-id", state.workspaceId];
  if (settings.tokenFile) {
    const token = await inputPath(settings.tokenFile, "file", false, true);
    need((await fs.readFile(token.path, "utf8")).trim().length >= 24, "Use a private access token of at least 24 characters.");
    inputs.push(token); args.push("--token-file", token.path);
  }
  return { args, inputs, createDirectories: [],
    resourceKey: digest({ family: "openlineage-workspace", directory: selected.path, workspaceId: state.workspaceId }) };
}
export async function openLineageStartup(request, text) {
  if (request.command !== "openlineage" || !Array.isArray(request.args) || request.args[0] !== "serve" ||
      typeof text !== "string" || text.length > 16384 || !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (ready.schema !== STARTUP) return null;
  const directory = resolve(argument(request, "--workspace")), expectedId = argument(request, "--expected-workspace-id");
  const portText = argument(request, "--port", false) ?? "8767";
  need(/^(0|[1-9]\d*)$/.test(portText) && Number(portText) <= 65535, "The selected OpenLineage port changed.");
  const normalizedUrl = applicationPrivateUrl(ready.url);
  need(normalizedUrl, "The original OpenLineage server did not announce a private local address.");
  const url = new URL(normalizedUrl);
  need(url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.hash &&
    (portText === "0" || Number(portText) === Number(url.port || 80)),
    "The original OpenLineage listener differs from its saved command.");
  const state = await new LineageWorkspace(directory).read();
  need(state.workspaceId === expectedId && ready.workspaceId === expectedId && ready.workspace === directory &&
    ready.workspaceCreatedAt === state.createdAt && /^[0-9a-f-]{36}$/.test(ready.instanceId ?? ""),
    "The original OpenLineage workspace identity changed.");
  const tokenFile = argument(request, "--token-file", false);
  const token = tokenFile ? (await fs.readFile(tokenFile, "utf8")).trim() : null;
  const response = await fetch(new URL("/api/identity", url), {
    headers: { "X-OpenLineage-Workspace": expectedId, "X-OpenLineage-Instance": ready.instanceId,
      ...(token ? { Authorization: "Bearer " + token } : {}) },
    signal: AbortSignal.timeout(5000), redirect: "error"
  });
  need(response.ok && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    "The original OpenLineage listener did not return its identity.");
  const bytes = []; let count = 0;
  for await (const part of response.body) {
    count += part.length; need(count <= 16384, "The original identity response exceeded its announced record.");
    bytes.push(part);
  }
  const live = JSON.parse(Buffer.concat(bytes).toString("utf8"));
  need(live.schema === STARTUP && live.workspaceId === expectedId && live.workspaceCreatedAt === state.createdAt &&
    live.instanceId === ready.instanceId && live.workspace === directory && live.url === ready.url,
    "The live original OpenLineage application differs from the selected workspace.");
  return { url: url.href, workspaceId: expectedId, original: live };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "openlineage-workspace", order: 390,
  catalog({ common, field }) {
    return [{ id: "openlineage-workspace", command: "openlineage", title: "OpenLineage operations",
      terminal: false, requiredSource: ROOT + "cli.mjs",
      description: "Import original lineage events, inspect jobs, runs and datasets, compare saved editions, retain decisions and attach complete customer results.",
      fields: [
        field("workspaceDirectory", "OpenLineage workspace", "path", true, "Select an initialized or received OpenLineage project directory."),
        field("tokenFile", "Private access token", "path", false, "Optional private file containing the existing workspace access token."),
        ...common
      ] }];
  },
  prepare(type, settings, context) { return prepareOpenLineageApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === "openlineage" && request.args?.[0] === "serve"; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{"schema":"' + STARTUP + '",') ? () => openLineageStartup(request, text) : null);
  }
};
