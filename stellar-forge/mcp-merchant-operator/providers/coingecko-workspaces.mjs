// MIT. Original coingecko-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { coingeckoWorkspaceTools } from "../catalog/coingecko-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "coingecko-workspaces", family: "coingeckoWorkspaces",
  title: "coingecko workspaces merchant", order: 290, catalogOrder: 250,
  configKey: "coingeckoWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "coingeckoWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../coingecko-workspace.mjs")).readCoinGeckoWorkspaceConfiguration(hostPath(value)) },
  tools: coingeckoWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_coingecko_",
      "text": "For CoinGecko research, list host-declared workspaces and open their original browser/model. Save complete requests and collections with stable opId, current project revision and current record version for updates. Inspect original host inputs and pin their SHA256 before importing full source bytes. Page every original capture, snapshot and comparison row; retain their source basis and exact numeric values. Provider plans use the original compiler and complete deployment download. Prepare native purchases from the current exact merchant challenge and inspect the same job before explicitly executing it. Preserve native SF31/SF36/SF88 identities, budgets and attempts. Recover an uncertain write with merchant_coingecko_operation and the same opId; use currentJob or inspect for present native action availability. Full project handovers restore through original source aliases or retained export IDs, with historical jobs archived. Download complete original files with their SHA256, readId and byte offset; close only the current owned instance.",
      "order": 260
    }
  ],
  load: () => import("../coingecko-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantCoinGeckoWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeCoinGeckoWorkspaceMerchant(options)
});
