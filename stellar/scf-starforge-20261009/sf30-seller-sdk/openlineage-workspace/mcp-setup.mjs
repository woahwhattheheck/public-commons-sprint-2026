// MIT. Replayable merchant-host setup through the original shared initializer.
import { readdir, lstat, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_SCHEMA, readMerchantConfig } from "../../../../stellar-forge/mcp-merchant-operator/config.mjs";
import { initReleaseStore, readReleaseState } from "../../sf82-seller-pilot/releases.mjs";
import { withPrivateLock, atomicJson } from "../routescan/quota.mjs";
import { durableDirectory, exactFile, optionalJson } from "../gdelt/source.mjs";
import { canonical, sha256 } from "./model.mjs";
import { readLineageWorkspaceConfiguration, lineageHostError } from "./mcp-client.mjs";

function need(value, message) { if (!value) throw lineageHostError(message, 409, "OPENLINEAGE_SETUP_CONFLICT"); }
export async function initializeLineageMerchantWorkspace({ directory, connection, name = "Starforge OpenLineage workspaces", releaseStore } = {}) {
  need(typeof directory === "string" && directory && typeof connection === "string" && connection,
    "Supply a new native merchant directory and original private workspace connection configuration.");
  need(typeof name === "string" && name.trim() && name.length <= 240 && !/[\x00-\x1f\x7f]/.test(name), "Use a plain native merchant name.");
  const root = resolve(directory), selectedConnection = resolve(connection);
  const selected = await readLineageWorkspaceConfiguration(selectedConnection);
  const binding = { schema: "stellar-forge.openlineage-native-setup.v1", name, connection: selectedConnection,
    configurationSha256: sha256(Buffer.from(canonical(selected))), releaseStore: releaseStore ? resolve(releaseStore) : null };
  await durableDirectory(root);
  return withPrivateLock(root, "openlineage-setup.lock", async () => {
    let intent = await optionalJson(join(root, "openlineage-setup.json"), 65536);
    if (intent) need(canonical(intent.binding) === canonical(binding), "This original setup belongs to a different host configuration.");
    else {
      need((await readdir(root)).every(name => name === "openlineage-setup.lock"), "Initialize an empty native merchant directory.");
      intent = { binding, attempts: [] }; await atomicJson(root, "openlineage-setup.json", intent);
    }
    const store = binding.releaseStore ?? join(root, "releases");
    if (binding.releaseStore) await readReleaseState(store);
    else {
      let exists; try { exists = await lstat(store); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (exists) {
        need(exists.isDirectory() && !exists.isSymbolicLink(), "Keep the original ordinary release store directory.");
        await readReleaseState(store);
      } else {
        let stage = intent.attempts.at(-1)?.directory, ready = false;
        if (stage) {
          try { await readReleaseState(stage); ready = true; }
          catch (error) {
            intent.attempts.at(-1).interrupted = true;
            intent.attempts.at(-1).error = error.message;
            await atomicJson(root, "openlineage-setup.json", intent);
          }
        }
        if (!ready) {
          need(intent.attempts.length < 32, "Inspect the retained release-store setup attempts before creating another directory.");
          stage = join(root, "release-store-preparing-" + randomUUID());
          intent.attempts.push({ directory: stage, startedAt: new Date().toISOString() });
          await atomicJson(root, "openlineage-setup.json", intent);
          await initReleaseStore(stage);
        }
        await durableDirectory(join(stage, "releases")); await rename(stage, store); await durableDirectory(root);
        await readReleaseState(store);
      }
    }
    await durableDirectory(join(root, "customer-exports"));
    const configuration = join(root, "merchant-mcp.json"), config = {
      schema: CONFIG_SCHEMA, name, releaseStore: binding.releaseStore ?? "./releases", exportsDirectory: "./customer-exports",
      sources: {}, openlineageWorkspaceConnection: selectedConnection
    };
    await exactFile(root, "merchant-mcp.json", Buffer.from(JSON.stringify(config, null, 2) + "\n"));
    await readMerchantConfig(configuration);
    const result = {
      schema: CONFIG_SCHEMA, configuration, state: "INITIALIZED", openlineageWorkspacesConfigured: true,
      workspaces: Object.entries(selected.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label, workspaceId: entry.workspaceId })),
      hostOwnership: "ORIGINAL_OPENLINEAGE_HTTP_WORKSPACE"
    };
    await atomicJson(root, "openlineage-setup-result.json", result);
    return result;
  });
}
