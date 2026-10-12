# Economic data editions in managed Applications

Open the original FRED project from the standard Applications interface. Its source captures, saved review and publication history, customer requests and recovery remain in that project. The existing terminal carries native buyer approval; the existing managed process provides Start, Open, Stop and Reopen.

## Select the original product and operator

Choose **Applications → New application → Economic data editions** in a managed workspace whose selected runtime includes the current `fred` component and its `launch.mjs` source. Select the initialized private project directory. A project produced by the [one-command receiver](../../sf30-seller-sdk/fred/RECEIVER.md) opens directly. The separately received project also opens as its own application; use its original path.

| Field | Selection |
|---|---|
| Original economic project | Canonical absolute path to the existing private project containing `project.json`. |
| Original buyer configuration | Existing private SF88 JSON, with the original runtime, payer, operator profile and intent journal. Omit to work on source and merchant preparation. |
| Configured facilitator URL | The facilitator already used by the original testnet or mainnet operation. The local HTTP option applies only to its explicitly selected `127.0.0.1` service. |
| Original routed merchant port | Loopback merchant port already routed by the publication's canonical HTTPS origin. Keep this distinct from the private operator UI port. |
| Terminal Python executable | Existing Python used by the Applications terminal; defaults to `/usr/bin/python3`. |
| Port | Private operator UI port; zero chooses an available port. |
| Environment file | Optional existing private environment input, including the selected FRED API key variable when making API acquisitions. |

Select **Review**, inspect the project/operator and selected installed release, then **Save**. The saved application uses the existing managed adoption flow. Select **Review start → Start → Open** when that release is ready. Source revisions, selected captures and new purchases can change normally between openings; the saved application keeps the original project identity and operator selection.

## Work from complete original economic data

The retained [macro starter](../../sf30-seller-sdk/fred/sources/MACRO_STARTER.md) supplies original UNRATE, CPIAUCSL and GDP public tables. UNRATE contains 945 observations, CPIAUCSL 956, and GDP 318. Each table retains its publisher, units, frequency, seasonal adjustment, retrieval time and missing-value strings. Public-table retrieval dates remain distinct from an API vintage.

For a new project, run the maintained original CLI once from the selected runtime, or use the complete native receiver. This example initializes the UNRATE project and imports its complete source:

```sh
starforge fred init --project /private/economic-project --title 'Economic data' --selection /installed/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/unrate-selection.json
starforge fred import --project /private/economic-project --id original-unrate-import --expected-revision 1 --source /installed/source/stellar/scf-starforge-20261009/sf30-seller-sdk/fred/sources/unrate-20261012.public-table.json
```

Use the actual selected installed source path in those commands. Existing projects reopen through Applications. The source screen can import the other complete starter tables into the same project, combine selected captures into one edition, or acquire an explicitly selected FRED/ALFRED API vintage using the configured key.

Review observations, compare revisions, retain analyst notes and publish the selected edition with the original payment terms and canonical merchant origin. Start the merchant from that publication; it binds the selected routed merchant port. Stop/drain it before another host takes the same original route.

## Continue the original customer operation

Open the publication's customer pane, select the existing prepared intent, then recover its original result or approve the prepared request through the Applications terminal. Saved page requests preserve their original dataset snapshot and cursor. Source and CSV downloads retain their original delivery bytes. The same buyer configuration points to the original intent journal after Stop and Reopen.

The [native receiver](../../sf30-seller-sdk/fred/RECEIVER.md) is the executable source → review → merchant → configured buyer → two pages/source file/CSV → export/reopen workflow. Continue its original project, configuration and intent IDs. Its independent `--phase browser` resumes source review, saved customer downloads and exported/received-project views after native work has completed.

## Stop and reopen

Use **Stop** in Applications. The existing terminal process sends the original signal; FRED closes its pending source/customer action and drains the merchant it started. The saved application and original records stay available. Select **Review start → Start → Open** to reopen them.

Review and Save updated settings when deliberately selecting a different buyer configuration or facilitator. Project identity, canonical directory and buyer settings are checked by the original FRED command immediately before opening. The launcher saves Open only after the original startup message and authenticated live project agree. Startup metadata contains the project identity and configuration digest; API keys and buyer configuration contents remain in their original private input.

## Receiving through the existing installed runtime

Use the distribution owner's existing selected READY runtime containing this complete FRED producer. Open the same original or received project, inspect its saved capture/review/publication, recover a previously completed customer download with its original buyer, then Stop and Reopen. Return the managed application ID, original operation IDs and resulting private output paths under the existing FRED receiving thread. The existing runtime and Applications home remain the owner of this operation.
