# Connect Research to the original Buyer application

Use this setup to turn an existing SF88 operator workspace or Buyer operator preset into a usable Research Buyer connection. It starts the maintained Buyer application, retains its actual launch and selected source, adopts the selected preset through the original local-operator review/save, and writes the complete agent and Research host configuration. An existing Applications-managed Buyer can be attached through its actual retained launch instead.

The Research acquisition continues through the ordinary **Paid delivery** screen, JavaScript/Python clients, CLI and Merchant agent. Those interfaces retain the original publication, payment approval, Buyer run, retrieval and editable dossier receiving described in [Paid Research delivery](OPERATING.md).

## Choose the original application owner

| Starting point | Command | Owner after setup |
| --- | --- | --- |
| Existing original SF88 operator, with no Buyer application already selected | `commerce-buyer-serve` | This foreground command owns the original Buyer listener and its setup lease. |
| Existing Buyer Runbook application launched through Applications | `commerce-buyer-attach` | Applications keeps its current listener; the command retains the connection and then detaches. |
| Previously completed setup | Repeat the same command with its original directory | The original input, selected source, operator adoption and generated files reopen. |

Select the actual Buyer intended for this Research programme. If it is already running, use its existing launch. A Research host attaches to that Buyer through its existing agent client; it does not need another Buyer or Merchant listener.

Every setup directory and input file is private to the launching account. The first input file lives outside the new setup directory. The setup creates its own child directories and retains the original request before it admits work. Use absolute canonical paths and a private existing parent directory.

## Start from an existing original SF88 operator

The original SF88 directory contains its existing `workspace.json`, `operator.json`, policy and accounting history. Save an input such as this outside the setup directory:

~~~json
{
  "schema": "sf88-research-buyer-setup/v1",
  "buyer": "research-acquisition",
  "label": "Research acquisition",
  "operator": "original",
  "operators": {
    "original": "/srv/research-private/original-operator"
  },
  "paidFileClaimEnvs": ["SF101_CLAIM_TOKEN"],
  "approvalMode": "BROWSER",
  "port": 0
}
~~~

`operator` selects one alias in `operators`. The original read-only SF88 workspace reader validates the selected operator, payer, network, asset, policy and signer references. The setup copies only the resulting preset and original source identities. It does not initialize a new spend ledger or read its journal key.

The preset's total limit comes from the original policy. Its daily limit is the minimum of the original total, per-day, per-actor/day and per-service/day ceilings. These are policy ceilings, **not a remaining-balance calculation**. The actual original operator and ledger still determine whether the later reviewed Research purchase fits its available budget. If the native operator requires different approved terms for a new Research order, use its existing configuration/review workflow and select the resulting preset.

The preset keeps the original secret-environment or signer-provider reference, Python executable and RPC selection. An explicit-connect transport retains the original proxy-environment name. The setup requires an environment reference for that transport; it does not copy an inline proxy credential into the preset.

Start it from the complete repository:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-cli.mjs \
  commerce-buyer-serve \
  --input /srv/research-private/buyer-input.json \
  --run-directory /srv/research-private/research-buyer
~~~

An installed distribution exposes the same command:

~~~sh
research-client commerce-buyer-serve \
  --input /srv/research-private/buyer-input.json \
  --run-directory /srv/research-private/research-buyer
~~~

The direct `research-commerce` entry point accepts the identical command and flags. Keep the process in the foreground. It prints one complete ready announcement after the original listener, agent connection and local-operator adoption are usable. The announcement and full launch are also retained inside the setup directory; there is no need to redirect startup output into a new directory before setup.

Port `0` selects an available loopback port and records the actual URL. Browser mode uses the existing Buyer approval panel at that URL. Terminal mode uses the original process's interactive terminal; launch it in the same maintained PTY/terminal when that approval mode is selected.

The process inherits the original operator's signing/proxy environment and the declared paid-file claim value. `paidFileClaimEnvs` contains environment-variable **names**. Keep the corresponding values in the original host environment. Availability is reported by the original Buyer and does not substitute for its approval or signing action.

## Select an existing Buyer preset instead

If the original Buyer owner has already saved the complete operator preset, replace `operator` with `operatorSettings`:

~~~json
{
  "schema": "sf88-research-buyer-setup/v1",
  "buyer": "research-acquisition",
  "operatorSettings": "/srv/research-private/original-buyer-preset.json",
  "operators": {
    "original": "/srv/research-private/original-operator"
  },
  "paidFileClaimEnvs": ["SF101_CLAIM_TOKEN"],
  "approvalMode": "BROWSER",
  "port": 0
}
~~~

Supply exactly one preset source. The setup validates and retains that preset's exact bytes before launch. The `operators` map declares the actual original accounting operators available to native Buyer actions; a preset does not replace those directories or their ledgers.

## Attach an Applications-managed Buyer

Applications already publishes the original Buyer's full launch record. Select that actual file, the matching original preset, and its declared operator directories:

~~~json
{
  "schema": "sf88-research-buyer-setup/v1",
  "buyer": "research-acquisition",
  "label": "Research acquisition",
  "operatorSettings": "/srv/research-private/original-buyer-preset.json",
  "operators": {
    "original": "/srv/research-private/original-operator"
  },
  "launchFile": "/srv/research-private/applications/buyer-launch.json"
}
~~~

~~~sh
research-client commerce-buyer-attach \
  --input /srv/research-private/buyer-attach-input.json \
  --run-directory /srv/research-private/research-buyer-attachment
~~~

Use the actual retained launch announced by that Applications instance, rather than a copied selection digest or a Merchant-console launch. Attach verifies its original format, semantic selection, source-file identities, loopback listener, process and instance through the original Buyer agent.

The active Buyer must already expose the selected effective operator settings. Attach compares the exact preset hash and values before original local adoption. If the application uses a separately formatted preset, select that exact original preset file. The original Applications owner supplies its approval mode, port, claim names and process lifetime; omit those fields from the attach input.

A successful attach command closes only its borrowed agent and setup lease. Its saved service state becomes `ATTACHED`; the original Buyer application remains running.

## Generated operating files

The ready announcement returns the exact paths. For a served setup at `/srv/research-private/research-buyer`, they are:

| File or directory | Purpose |
| --- | --- |
| `request.json` | Immutable first setup input, mode and digest. |
| `operator-settings.json` | Exact retained original preset or the validated preset derived from the original SF88 reader. |
| `operator-source.json` and `operators.json` | Original preset/policy source and declared operator-directory identities. |
| `buyer/` | The original Buyer workspace when this command owns its launch. |
| `selection.json` | Complete original semantic selection, selected source files and actual selection digest. |
| `launch.json` | The actual current served Buyer's launch. Attach uses its selected external launch file instead. |
| `launch-INSTANCE.json` | Retained full launch for each actual instance seen by this setup. |
| `agent-connections.json` | Complete original Buyer agent configuration, including launch/selection binding, preset handle, operator aliases and file limits. |
| `agent-files/` | Private original agent storage, outside the Buyer workspace. |
| `operator-proposal.json`, `operator-save.json`, `operator-adoption.json` | Exact original review/save request and completed local-operator revision. |
| `research-commerce.json` | Complete host configuration to select in the original Research server. |
| `service.json` | Current setup state and complete ready announcement. |

The agent configuration uses the original schema `stellar-forge.buyer-runbook.agent-connections.v1`. Its workspace alias is the input's `buyer`. The source digest is calculated by the original launch inspector from both the semantic selection and actual maintained source files. The setup then opens the original agent against the live listener to verify that same selection.

Local operator adoption uses the original `operator_review` and `operator_save` interfaces. The immutable save request has one deterministic request UUID derived from this setup's original input digest. If its first response is interrupted, reopening reuses that native request. The completed adoption stores the original revision. Reopening first checks that the current configured preset still matches the retained hash and values, then verifies that original saved revision. A different current preset remains untouched and returns `RESEARCH_BUYER_SETUP_OPERATOR_DIFFERENT`; select its exact current preset through the original owner when configuring a distinct setup.

## Keep the existing merchant and other buyers

To build on the programme's current host configuration, add:

~~~json
{
  "commerceConfigurationFile": "/srv/research-private/original-research-commerce.json"
}
~~~

Include this field in the first complete setup input. The setup validates and retains that source, resolves its relative file references against the original directory, and writes a complete derived host file. All other merchant and Buyer aliases keep their original selections. The source configuration is left intact.

If that original host already declares the same buyer alias with a different selection, the setup reports `RESEARCH_BUYER_SETUP_BUYER_ALIAS_EXISTS`. To deliberately replace that one alias in the **generated copy**, include `"replaceBuyer": true` in the reviewed first input. Other aliases remain unchanged.

Without a base host, the generated file contains the one Buyer alias and an empty merchant map. That is sufficient for a customer-only Research workspace. A seller/buyer programme selects its existing complete host as the base so the original checkout remains available.

## Open Research on the generated connection

Use the exact `commerceHostFile` from the ready announcement:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /srv/research-private/original-research \
  --connection-file /srv/research-private/research-connection.json \
  --customer-commerce-host /srv/research-private/research-buyer/research-commerce.json \
  --port 8846
~~~

The existing Research application owner selects this path on its normal launch. If Research is already running with a different host-configuration path, that owner drains and reopens the same Research workspace with this selected path. Keep all other source, extraction, pipeline and connection options from its original launch.

Open **Paid delivery** and select the declared Buyer alias. **Open Buyer approval** uses the actual original Buyer URL. The same selected configuration also reaches `ResearchWorkspaceClient.customerCommerce()`, the installed Python client and the original twenty-tool Merchant commerce interface.

Verify the declared configuration and the already saved purchase through the original Research connection:

~~~sh
research-client commerce-configuration \
  --connection-file /srv/research-private/research-connection.json

research-client commerce-purchase --id ORIGINAL_PURCHASE_UUID --refresh \
  --connection-file /srv/research-private/research-connection.json
~~~

Use the saved native request and original operation directory for the next indicated action. For example, completed editable receiving reopens directly:

~~~sh
research-client commerce-receive-dossier \
  --run-directory /srv/research-private/operations/original-dossier-receiving
~~~

An in-progress original action continues with its original connection and retained directory:

~~~sh
research-client commerce-retrieve \
  --connection-file /srv/research-private/research-connection.json \
  --run-directory /srv/research-private/operations/original-retrieve
~~~

The original programme determines whether retrieval, recovery, finalization or editable receiving is next. Follow [Paid Research delivery](OPERATING.md) for its actual input shapes, explicit original-request replay, complete archive export and continued customer editing. Setup completion itself changes no purchase state.

## Reopen, inspect and stop

Repeat the original setup command without another input file:

~~~sh
research-client commerce-buyer-serve \
  --run-directory /srv/research-private/research-buyer

research-client commerce-buyer-status \
  --run-directory /srv/research-private/research-buyer --live
~~~

For an attached application, repeat `commerce-buyer-attach` with its original setup directory. A subsequent Applications launch must keep its selected semantic/source identity and update the selected actual launch file through its original owner.

Cold status without `--live` reads the retained setup even after the Buyer listener has closed:

~~~sh
research-client commerce-buyer-status \
  --run-directory /srv/research-private/research-buyer
~~~

A same-directory reopen keeps the first input, original preset bytes, declared operator-directory identities, source selection and local adoption. Supplying the input again checks its complete semantic digest. A changed source or input is reported explicitly; it does not silently reconfigure the saved setup.

SIGINT or SIGTERM stops the served setup through the same acquired owner. The setup closes its borrowed agent, drains the original Buyer application, writes `STOPPED` while its original setup lease is still held, then releases that lease. Failed startup and output retain the original cleanup handle. A failed close keeps the foreground owner available for a later signal; an uncertain raw-lease close is not invoked again.

The setup never stops an externally attached Applications owner. That application's original Stop action governs its listener and native work.

## Restart on the same host or receive on another host

A normal same-host restart retains the original setup and Buyer directories. Stop the original owner first, then repeat the setup command with its saved directory. The served mode records the new actual process/instance and launch URL; the semantic source selection and original local-operator adoption remain the same. Attach follows the existing Applications owner's current launch file.

Directory device/inode values, process IDs, listener instances and absolute source paths identify the actual local host. They are not portable claims that a copied directory still has a running owner. Preserve the original setup records with the programme's completed artifacts, but do not overwrite their local identities to make a copy look active.

On a receiving host, first use the existing SF88, Buyer and Research receiving/restoration workflows to establish their actual restored directories and original operation history. Select the resulting original operator/preset and actual Buyer owner. If Applications is already running that Buyer, create a new explicit attachment setup using its real launch file. Otherwise create a new explicit served setup beside the restored original operator. This new local setup publishes that host's actual agent connection and source/launch selection.

The original Research owner selects the newly generated host file when opening the restored Research workspace. Preserve each existing publication, purchase, Buyer run, approval and action directory. Continue or reconcile those original actions through their native receiving/recovery interfaces; a new local setup does not turn a different listener or source selection into the old prepared purchase. The complete acquired archive and completed Research receiving result remain the original portable delivery records.

## Programmatic use

~~~js
import {
  serveResearchBuyerWorkspace,
  attachResearchBuyerWorkspace,
  readResearchBuyerSetup,
} from './buyer-setup.mjs';

const application = await serveResearchBuyerWorkspace({
  directory: '/srv/research-private/research-buyer',
  inputFile: '/srv/research-private/buyer-input.json',
});
try {
  console.log(application.announcement.commerceHostFile);
  const current = await readResearchBuyerSetup({
    directory: application.directory,
    live: true,
  });
  // The original Research owner uses the generated host for its existing programme.
  console.log(current.live.launch.connection.selectionSha256);
} finally {
  await application.close();
}
~~~

Long-running callers retain `application.close` until the original close succeeds. A failed start with `error.close` carries that same retained recovery owner. The complete signatures are in [buyer-setup.d.mts](buyer-setup.d.mts). Attach returns the ready announcement after detaching its setup owner.

## Original 921BA0 / AF825 receiving inputs

The existing native API programme retained its original checkout and SF88 operator under:

- `/dev/shm/921ba0-api-native-20261011/checkout.json`
- `/dev/shm/921ba0-api-native-20261011/operator-workspace`
- `/dev/shm/921ba0-api-native-20261011/buyer-state`

The paid driver used the Buyer SDK directly, so its Merchant-agent journal is not a Buyer Runbook launch. For this same programme, the setup input can select `operator: "original"`, declare that exact operator directory, and declare `SCF_API_NATIVE_CLAIM`. It inherits the existing original signer/proxy environment through the programme's native owner. The actual Research checkout remains the selected merchant in the programme's existing host configuration.

Retain the original Research request `research-nct03529110-dbc61-20261012-01`, its saved customer delivery, order, reviewed purchase budget and native action directories. AF825/DBC61/F99A remain the owners of that continuation and complete receiving. Return this setup's actual ready announcement and generated host path into the same programme, then continue its ordinary acquisition, full dossier/source export and cold reopen.
