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

## Complete original receiving operation

RECEIVING.md and configuration.example.json describe WQX-CONCENTRATION-POTOMAC-9F77-20261012. The maintained source/browser/verify driver restores the original graph, reproduces the original review and corrected plan, completes all concentration choices, saves through the actual browser, downloads eleven outputs, receives them in another empty project and cold-reopens both projects.

Before the first phase on an equipped host, bind its actual application, output, Python/Node, Playwright and Chromium paths. Retain that configuration and operation directory for continuation. The existing serial worker allowance is 1,536 MiB memory plus 256 MiB reserve and 512 MiB additional ordinary disk plus 64 MiB reserve.

## Source and package identity

APPLICATION_SOURCE.json lists all 651 exact original source members, their lengths and SHA-256 values. It composes the original 3d9d8fef WQX operator source with the complete cd5da917 concentration feature. All twenty feature/operating files are merged in public sprint PR 2004, merge dc8c5f758ccda3984047f882ada8ac49b5f4949d.

PACKAGE.json identifies this complete source application edition and the original receiving operation. The application/LICENSE file carries its original MIT license. Keep the complete package, source manifest and your separate private working project when transferring the application.
