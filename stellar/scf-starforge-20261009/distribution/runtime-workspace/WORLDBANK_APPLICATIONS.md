# World Bank economic data in Applications

World Bank economic data opens the retained source workspace through the standard Applications controls. The original industrial browser and the merchant agent share one model, including saved selections, acquired source pages, revision comparisons, reviews, exports, the original publisher and customer preparation.

## Complete the runtime installation

Select the native runtime and the **mcp** feature when preparing the installation. World Bank Applications uses the merchant MCP host as well as the native World Bank source workspace. The installed profile therefore includes the MCP SDK, the original x402 MCP adapter and jose together with the native x402/Stellar dependencies.

Prepare and complete the runtime through the maintained installer from the selected original package:

```js
import { prepareRuntimeInstall, installRuntime } from './runtime-install.mjs';

await prepareRuntimeInstall({
  directory: '/private/worldbank-runtime',
  archive: '/private/releases/starforge-original.tgz',
  sha256: originalArchiveSha256,
  native: true,
  features: ['mcp'],
  operator: true,
  pins: { '@stellar/stellar-sdk': '16.3.1' },
  python: '/usr/bin/python3',
});
const runtime = await installRuntime({ directory: '/private/worldbank-runtime' });

```

Create a real private temporary directory on the selected host and set `TMPDIR` before starting the installer or receiving command. Runtime adoption uses the host's temporary directory while unpacking a release, so this selection must have room for the original source and belong to the same operator:

```sh
mkdir -p /private/worldbank-temporary
chmod 700 /private/worldbank-temporary
export TMPDIR=/private/worldbank-temporary
```

Use the selected release archive and its recorded SHA-256. The installer retains the dependency selection, package lock, installation identity and original source. Continue an interrupted installation in that same directory through `installRuntime`. When restoring a saved operating directory, preserve its private permissions and original absolute paths so the existing Applications records continue to identify the same runtime.

## Open the retained workspace

Select **Applications → New application → World Bank economic data** in an installed runtime containing the `worldbank-agent` command. Choose the same private merchant configuration and World Bank alias already used by the [merchant workspace](../../../../stellar-forge/mcp-merchant-operator/WORLDBANK-WORKSPACES.md). The launcher reads those declarations; it opens their existing source directory.

| Field | Selection |
|---|---|
| Merchant configuration | Canonical absolute path to the existing private `merchant-mcp.json`. Its `worldbankWorkspaceConnection` names the original workspace connection JSON. |
| World Bank workspace | The exact alias from that connection, such as `research`. |
| Agent port | Loopback port for the original merchant MCP endpoint. Zero chooses an available port. |
| Agent token environment name | Defaults to `MCP_ACCESS_TOKEN`. Enter an environment name, with its value supplied by the host or private environment JSON. |
| Local port | Loopback port for the original browser. Zero chooses an available port. |
| Private environment JSON | Optional existing private JSON whose values are environment strings. The selected host supplies the MCP token and any original configured credentials. |

Select **Review**, inspect the selected runtime and source configuration, then **Save**. Applications adopts that same completed runtime through the maintained release manager. **Review start → Start → Open** launches one merchant owner and opens the World Bank browser it owns.

The startup check authenticates to the actual browser and compares its model and browser instance with the original command announcement. Its saved URL belongs to that application operation. The private agent endpoint is retained alongside that identity in the original operation output.

The selected merchant configuration is a shared process resource. Two saved applications using that same merchant host cannot start duplicate owned processes through Applications; use the existing running application. The native merchant lease also retains the original process owner across other entrypoints.

## Continue source and customer work

Use the browser's saved selections and captures, or connect an MCP client to the endpoint in the original application output. The existing [22 World Bank tools](../../../../stellar-forge/mcp-merchant-operator/WORLDBANK-WORKSPACES.md) operate the same model.

The complete workflow remains:

1. Select the original World Bank source, countries, indicators and date range. Keep aggregate-country labels, null values, observation status, units, footnotes and exact numeric strings with the original edition.
2. Capture every selected source page, or import a host-declared original page receipt or complete handover. Interrupted capture work resumes with the same capture ID and acquired pages.
3. Compare an edition with a selected baseline, save an analyst review at its displayed revision, and export the original dataset and handover.
4. Prepare that export with a declared merchant profile. The original publisher stages and operates its SF82 release; customer preparation uses the existing SF88 intent and buyer configuration.
5. Download the complete files using the retained export ID and manifest. The existing receiver keeps its byte position across interruption. Receive the original handover into the customer's own declared workspace and reopen its exact source rows.

The completed reference edition contains 42 Canada, Mexico and United States GDP and population observations for 2018–2024. It preserves the original World Bank source-2 response values, including Canada 2024 GDP `2270076189683.46`. The original reference handover is retained in `examples/worldbank-reference-capture.json`; the receiving driver reads and verifies those exact bytes.

The original [source-to-customer receiving example](../../../../stellar-forge/mcp-merchant-operator/examples/worldbank-native-receiving.mjs) performs source import, comparison, review, export, merchant release, buyer preparation, interrupted download, customer reopening and stdio operation. Applications adds saved process ownership and the installed release lifecycle to this same product.

## Stop, reopen and recover

Select **Stop** on the running application. Its original host drains accepted work and retained reads, closes the borrowed browser and the native model, and releases its merchant lease. Saved captures, reviews, publications, export files and buyer preparation remain in their existing locations.

To reopen, review a new start from the saved application. The connection and source directory stay selected; the new live process and browser receive new instance IDs. Ordinary capture and review changes do not invalidate the saved configuration. An edited connection is inspected again by the next start review.

If the console closes after a start was saved, reopen the same Applications workspace and select **Continue original start**. The maintained operation journal reuses the original request ID; it reconnects to the existing process or dispatches that same saved start. A pending start can be cancelled through the same Stop control before dispatch. The original operation's output remains available after it ends.

If source configuration changes between review and start, Applications returns the current-input review requirement. Open the same saved application and review its current configuration. The source workspace itself continues to retain its data.

## Installed command and SDK

The distribution contribution `contributions/worldbank-applications.json` registers the command and SDK export alongside the original provider's commands. It composes through the maintained distribution specification.

```sh
starforge worldbank-agent inspect --config /private/worldbank-host/merchant-mcp.json --workspace research

starforge worldbank-agent serve --config /private/worldbank-host/merchant-mcp.json --workspace research --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
```

A reviewed launch also supplies `--expected-binding-sha256` with the value returned by inspection. The startup announcement retains the original browser URL, MCP endpoint, configuration binding, source directory, model instance and browser instance. Store this private operation output with the original Applications workspace.

The SDK export is `@tokenjunkielabs/starforge-merchant/merchant/mcp/worldbank-launcher`, providing `inspectWorldBankAgentBinding`, `startWorldBankAgentWorkspace` and the original CLI `main`. Close the returned application to drain its owned host.

## Complete managed receiving

Run the [managed receiving example](../../../../stellar-forge/mcp-merchant-operator/examples/worldbank-managed-receiving.mjs) with an existing completed runtime and a new private receiving directory. It uses the original Applications model, installer adoption and managed worker; its retained journey links every saved application and operation to the original source edition.

```sh
node /installed/source/stellar-forge/mcp-merchant-operator/examples/worldbank-managed-receiving.mjs --runtime /private/ready-runtime --workdir /private/worldbank-applications-receiving --python /usr/bin/python3
```

Run the same command with the same `--runtime` and `--workdir` after an interruption. The driver recovers the saved application, original source import and reviewed export; it reconciles a pending or surviving application run before choosing its next start. Once the prior run has ended, it records a new start request against the same saved application. Completed merchant work and customer downloads keep their original identities, even when a restarted MCP host has a different loopback port. A retained buyer offer is reopened before preparation, so recovery stays attached to the original reviewed request.

The directory retains the original input, source workspace, merchant declaration, Applications record, operation logs, complete download and customer receiving. Its private environment file contains the generated local agent token. The customer receives `customer-download/handover.zip`; the operator retains the complete private working directory and its selected installed runtime.

For a complete private checkpoint, preserve filesystem symlinks and hardlinks, private directory permissions, and the original absolute paths used by the runtime and saved Applications records. Archive link objects rather than following them into repeated runtime/source copies. Python's `tarfile` data filter deliberately omits directory modes during extraction; restore the private runtime root to mode `0700` before using the original installer or Applications recovery. The maintained installer checks the same source, selected dependency profile and lock before returning READY.

The original installed reference completed the complete Applications, source, merchant, download, Stop, saved-start recovery and second-customer journey on 12 October 2026. It retained all 42 original observations and six customer files. The [original managed receiving outcome](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791785852097869?thread_ts=1791764726.590409) and the source-bound `managed-journey.json` connect those completed steps to the selected installation.
