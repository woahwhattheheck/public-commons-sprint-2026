# WQX water-quality and concentration workspace

Open, review and hand over complete water-quality data with its original sampling records, laboratory qualifiers and reported limits. This application includes the private browser workspace, source acquisition/import, scientific review, Open Waters receiving plans, full CSV/TSV decisions, exact concentration preparation and portable project receiving.

## Start the operator

Use an existing Node.js 24.19 or later installation. Extract this complete ZIP, keep the application directory intact and run from the extracted package root:

```sh
node application/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/cli.mjs serve \
  --project /absolute/private/water-quality-project --port 0
```

Open the actual local URL printed by that command. Choose a private absolute project directory you will retain. The browser stores source and decisions in that project; repeat the command with the same directory to reopen it.

The operator can save a native source selection, acquire or import its original Station/Activity/Result profiles, inspect scientific groups and limits, save an analysis review, prepare a receiving plan and export the complete review into another empty workspace. The source project's original acquisition and receiving documentation is in application/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/README.md.

Merchant/buyer operations have their separate original configuration and runtime instructions in that same directory. The concentration and private-review workflow uses its original Node application and source graph.

## Work with the included original source

The application carries the complete original Potomac capture and its corrected receiving plan. It contains 1,035 results, 13 activities, one station and 1,112 original reported limits. Its captured source dates are January through March 2025 at USGS-01646580.

To restore the exact retained graph into a private directory, use Python 3.11 or later:

```sh
python3 application/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/concentration-source.py \
  --source application/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/review-sheet/examples/potomac-concentration-source.json \
  --sha256 812f32327f09d871dea9a8f52a5feb3e920c0d854d798383af217efdd52b85ec \
  --directory /absolute/private/potomac-source

node application/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/cli.mjs import-capture \
  --project /absolute/private/water-quality-project \
  --source /absolute/private/potomac-source/source/capture \
  --title "Potomac water-quality review" --expected-revision 0
```

The import command above is for an empty project. For an existing project, read its current revision with the config command and use that exact revision. Keep all source members together; the original importer verifies their identities.

## Prepare concentration choices

Open a saved receiving plan in the Bulk receiving review workspace. The Concentrations panel lists the exact original unit groups and the supported reported-limits-only selection. Select the source group or explicit result IDs, choose the target mass-per-volume unit and enter the reason. Review the proposed result and limit changes before applying them to the editable draft.

Every independently reported limit retains its type, original unit, qualifier, source reference and converted representation. Empty result/unit pairs stay empty. Unsupported dimensions remain visible for an explicit decision. The original Turbidity NTRU optical limits are preserved.

Preview the complete draft, save its receiving plan and decision review, then download the complete bundle for an independent receiving project. The original CSV/TSV editors preserve paired choices and their reasons. CONCENTRATIONS.md contains the full browser, API, CLI and scientific contract.

For the included source, the complete supported selection is 749 records and 1,089 reported limits. The remaining optical record carries an explicit Keep. All 1,035 original records and 1,112 original limits stay in the plan. The included original-source-execution.json records the completed exact converter calculation and its connected V8 runtime.

## Use the concentration MCP operator

The same private workspace is available through the complete 37-tool merchant operator, typed JavaScript client and installed CLI. `concentration-units` returns the exact source groups; `concentration-prepare` prepares a complete original result group or supported reported-limits-only group into a reusable document; `concentration-report` reopens the saved conversion report in JSON or CSV. Every full response and editable document is retained as an ordinary operator file.

Read application/stellar-forge/mcp-merchant-operator/WQX_CONCENTRATIONS.md for the complete workspace selection, file transfer, typed client and CLI operation. The original WQX_WORKSPACE.md and WQX_WORKSPACE_CLIENT.md carry the shared launch and connection settings. The original exclusive CLI output reservation and resumable file upload/download remain in use.

## Complete original receiving operation

RECEIVING.md and configuration.example.json describe WQX-CONCENTRATION-POTOMAC-9F77-20261012. The maintained source/browser/verify driver restores the original graph, reproduces the original review and corrected plan, completes all concentration choices, saves through the actual browser, downloads eleven outputs, receives them in another empty project and cold-reopens both projects.

Before the first phase on an equipped host, bind its actual application, output, Python/Node, Playwright and Chromium paths. Retain that configuration and operation directory for continuation. Run the source, browser, verification and MCP phases serially. The complete current operation has a planning allowance of 2,048 MiB memory plus 256 MiB reserve and 1,024 MiB additional ordinary disk plus 64 MiB reserve. The operator result records actual generated file lengths and hashes so retained growth can be reconciled after the run.

## Source and package identity

APPLICATION_SOURCE.json lists all 653 exact source members, lengths and SHA-256 values. The edition composes the frozen original 3d9d8fef WQX operator, complete concentration product dc8c5f75, and the complete 37-tool concentration operator merged in PR2181 at 93cbd37394aaffbefc8d2df940b46148011e6a3d. All fourteen operator/source joins were read back exactly from that merge; all nine changed JavaScript modules passed the original Node parser.

PACKAGE.json identifies the complete source application and WQX-CONCENTRATION-POTOMAC-9F77-20261012 receiving operation. The original MIT license is application/LICENSE. Keep the complete application, this source manifest and the separate private working project when transferring the installation.
