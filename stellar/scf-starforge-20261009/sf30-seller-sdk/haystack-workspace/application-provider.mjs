// MIT. The original Haystack workspace in the maintained Applications lifecycle.
import { join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { inspectMerchantRuntime } from "../../sf46-release/runtime-package.mjs";
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup, applicationPrivateUrl } from "../../distribution/runtime-workspace/application-provider.mjs";
import { HaystackWorkspace } from "./store.mjs";
import { digest } from "./util.mjs";

const ROOT = "stellar/scf-starforge-20261009/sf30-seller-sdk/haystack-workspace/";
const STARTUP = "commons.haystack.startup.v1";
function need(value, message) { if (!value) throw new Error(message); }
function argument(request, name, required = true) {
  const positions = request.args.flatMap((value, i) => value === name ? [i] : []);
  if (!positions.length && !required) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === "string", "The saved Haystack command selection changed.");
  return request.args[positions[0] + 1];
}
export async function prepareHaystackApplication(settings, { inputPath, runtimeDirectory }) {
  const selected = await inputPath(settings.workspaceDirectory, "directory", false, true);
  const runtime = await inspectMerchantRuntime(resolve(runtimeDirectory), { load: false, source: false });
  const native = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + "store.mjs")).href);
  const state = await new native.HaystackWorkspace(selected.path).read();
  const inputs = [selected];
  const portable = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + "portable.mjs")).href);
  for (const file of portable.APPLICATION_FILES) inputs.push(await inputPath(join(runtime.sourceRoot, ROOT, file), "file"));
  const args = ["serve", "--directory", selected.path, "--host", "127.0.0.1", "--workspace-id", state.workspaceId];
  if (settings.tokenFile) {
    const token = await inputPath(settings.tokenFile, "file", false, true);
    need((await fs.readFile(token.path, "utf8")).trim().length >= 24, "Use a private access token of at least 24 characters.");
    inputs.push(token); args.push("--token-file", token.path);
  }
  return { args, inputs, createDirectories: [],
    resourceKey: digest({ family: "haystack-workspace", directory: selected.path, workspaceId: state.workspaceId }) };
}
export async function haystackStartup(request, text) {
  if (request.command !== "haystack" || !Array.isArray(request.args) || request.args[0] !== "serve" ||
      typeof text !== "string" || text.length > 16384 || !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (ready.schema !== STARTUP) return null;
  const directory = resolve(argument(request, "--directory")), expectedId = argument(request, "--workspace-id");
  const portText = argument(request, "--port", false) ?? "8768";
  need(/^(0|[1-9]\d*)$/.test(portText) && Number(portText) <= 65535, "The selected Haystack port changed.");
  const normalizedUrl = applicationPrivateUrl(ready.url);
  need(normalizedUrl, "The original Haystack server did not announce a private local address.");
  const url = new URL(normalizedUrl);
  need(url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.hash &&
    (portText === "0" || Number(portText) === Number(url.port || 80)),
    "The original Haystack listener differs from its saved command.");
  const state = await new HaystackWorkspace(directory).read();
  need(state.workspaceId === expectedId && ready.workspaceId === expectedId && ready.directory === directory &&
    ready.workspaceCreatedAt === state.createdAt && /^[0-9a-f-]{36}$/.test(ready.instanceId ?? ""),
    "The original Haystack workspace identity changed.");
  const tokenFile = argument(request, "--token-file", false);
  const token = tokenFile ? (await fs.readFile(tokenFile, "utf8")).trim() : null;
  const response = await fetch(new URL("/api/identity", url), {
    headers: { "X-Haystack-Workspace": expectedId, "X-Haystack-Instance": ready.instanceId,
      ...(token ? { Authorization: "Bearer " + token } : {}) },
    signal: AbortSignal.timeout(5000), redirect: "error"
  });
  need(response.ok && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    "The original Haystack listener did not return its identity.");
  const bytes = []; let count = 0;
  for await (const part of response.body) {
    count += part.length; need(count <= 16384, "The original identity response exceeded its announced record.");
    bytes.push(part);
  }
  const live = JSON.parse(Buffer.concat(bytes).toString("utf8"));
  need(live.schema === STARTUP && live.workspaceId === expectedId && live.workspaceCreatedAt === state.createdAt &&
    live.instanceId === ready.instanceId && live.directory === directory && live.url === ready.url,
    "The live original Haystack application differs from the selected workspace.");
  return { url: url.href, workspaceId: expectedId, original: live };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: "haystack-workspace", order: 395,
  catalog({ common, field }) {
    return [{ id: "haystack-workspace", command: "haystack", title: "Haystack building turnover",
      terminal: false, requiredSource: ROOT + "cli.mjs",
      description: "Import native building grids, inspect equipment and points, review complete typed tag proposals, compare saved editions and deliver editable operator workspaces.",
      fields: [
        field("workspaceDirectory", "Haystack workspace", "path", true, "Select an initialized or received building-turnover workspace."),
        field("tokenFile", "Private access token", "path", false, "Optional private file containing the existing workspace access token."),
        ...common
      ] }];
  },
  prepare(type, settings, context) { return prepareHaystackApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === "haystack" && request.args?.[0] === "serve"; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{"schema":"' + STARTUP + '",') ? () => haystackStartup(request, text) : null);
  }
};
