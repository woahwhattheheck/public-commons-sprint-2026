# Open the U.S. economic briefing

Open [the complete economic report](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing.html) in your browser. It works offline and carries its original observations, comparisons and source notes. No account, API key or merchant connection is required to read this saved edition.

## Read and reuse the report

The **Summary** tab shows the latest available observation in each selected series. **Measures** contains all 150 comparisons; select a series or calculation state to inspect its original current value, baseline, dates and units. **Sources & method** carries publisher metadata and the actual public-table retrieval dates. The report's **Download all measures** and **Download report data** buttons save the complete CSV and JSON locally.

The reporting window is January 2024 through September 2026. The full source has 2,219 observations; this report selects 75 and retains all 103 current/baseline observations needed for its comparisons. Of the 150 comparisons, 144 have both values, four retain a missing current value and two retain a missing baseline. Original missing values remain visible.

This is a retained October 2026 source edition. Its public-table retrieval basis is preserved; it is not an ALFRED historical-vintage selection or a live economic feed. Read each series' own source update and retrieval time before reusing its values.

| Series | How to read its changes |
| --- | --- |
| UNRATE | Original unemployment rate in percent. Absolute differences are **percentage points**. Relative percent change was not selected. |
| CPIAUCSL | Original monthly seasonally adjusted price index. Absolute differences keep the index units; relative changes use the selected exact period ratio. |
| GDP | Original nominal quarterly GDP in billions of dollars at a seasonally adjusted annual rate. The relative comparison is the direct ratio of the two published levels; it is not an annualized growth rate or real GDP growth. |

Absolute changes use exact decimal subtraction. Relative changes use the separately selected ratio and half-even rounding to six decimal places. The report does not resample dates or fill missing values. [The original operator guide](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/BRIEFINGS.md) explains every calculation state and baseline rule.

## What travels together

| Package content | Use |
| --- | --- |
| [briefing.html](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing.html) | Open the full offline report. |
| [briefing-measures.csv](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing-measures.csv) | Reuse all 150 comparisons, dates, units, literal values and calculation states. |
| [briefing.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing.json) | Reuse the complete report model and retained observations. |
| [briefing-manifest.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing-manifest.json) | Verify the original capture/review/report identity and report file hashes. |
| [macro-source.capture.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/macro-source.capture.json) | Import all 2,219 observations with the three complete original publisher table texts. |
| [review.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/review.json), [review-note.txt](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/review-note.txt), and [macro-briefing.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/macro-briefing.json) | Recreate the same saved review and analyst selection. |
| [macro-selection.json](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/macro-selection.json) | Initialize the original three-series project. |
| [MACRO_STARTER.md](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/sources/MACRO_STARTER.md), [BRIEFINGS.md](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/BRIEFINGS.md), and [FRED.md](stellar-forge/mcp-merchant-operator/FRED.md) | Original source intake, authoring, merchant/customer and installed connection instructions. |
| package-manifest.json | Verify every package member's byte length and SHA-256. Original members also retain their repository path and Git blob. |

The original report, source and guide files come byte-for-byte from Stellar Forge source [8f1d879cb1ba2947a05af770091568720ce31f65](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/8f1d879cb1ba2947a05af770091568720ce31f65/stellar/scf-starforge-20261009/sf30-seller-sdk/fred). Their source notices and publisher attribution remain attached. This package includes the complete worked example and its input files; install the maintained toolkit separately to operate a merchant.

## Continue in the original FRED application

Use your existing Stellar Forge installation containing the analyst briefing feature and its original dependencies. The [maintained installation guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/8f1d879cb1ba2947a05af770091568720ce31f65/stellar/scf-starforge-20261009/distribution/README.md) describes that installation. Do not run the files in this example as a replacement toolkit.

The following original commands create a **new private example project**. Replace the absolute paths first. Keep the exported package immutable; place the project and generated delivery in separate private directories. Import uses the retained source capture and needs no FRED API key.

```sh
FRED_ROOT=/absolute/extracted-package/stellar/scf-starforge-20261009/sf30-seller-sdk/fred
FRED_PROJECT=/absolute/private/economic-briefing

starforge fred init --project "$FRED_PROJECT" \
  --title "U.S. economic briefing" \
  --selection "$FRED_ROOT/examples/macro-selection.json"

starforge fred import --project "$FRED_PROJECT" \
  --id macro-original --expected-revision 1 \
  --source "$FRED_ROOT/examples/briefing-20261012/macro-source.capture.json"

starforge fred briefing-preview --project "$FRED_PROJECT" \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred review --project "$FRED_PROJECT" \
  --id macro-briefing-review --expected-revision 2 \
  --capture 4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c \
  --note "$FRED_ROOT/examples/briefing-20261012/review-note.txt" \
  --briefing-file "$FRED_ROOT/examples/macro-briefing.json"

starforge fred briefing --project "$FRED_PROJECT" \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802

starforge fred briefing-file --project "$FRED_PROJECT" \
  --review af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802 \
  --format html --out /absolute/delivery/economic-briefing.html
```

The capture ID is `4c7fc88552da69b9448054334bad10b72afee056ed93bcd2fb741d698dde042c`; the unchanged note and selection produce review `af00af636c9397ac146966fed06588ef531594c65bc1ec289eada76b4af97802`. The original native importer verifies the captured source. The report command reads the saved review, and the file command writes its full original HTML.

To continue an existing project, reopen it and read its current revision and retained operation IDs. Do not apply these fresh-project revisions to another project's current state. After an interrupted mutation, inspect/reconcile the same original operation before choosing another ID.

Open the same project's original industrial workspace:

```sh
starforge fred serve --project "$FRED_PROJECT" \
  --connection-file /absolute/private/economic-startup.json
```

In **Editions & review**, open the saved capture/review and its analyst briefing. The existing editor can change the interval, series, exact comparison methods or note and save a new reviewed edition. Keep the original report when saving a changed selection.

## Publish and deliver to a customer

Use **Merchant** in that original project to select the saved review, your existing merchant HTTPS origin and approved native payment profile. Publication advertises the original dataset and complete HTML/CSV/JSON/manifest assets. Follow [Publish and receive with the original merchant](stellar/scf-starforge-20261009/sf30-seller-sdk/fred/BRIEFINGS.md#publish-and-receive-with-the-original-merchant) and [the installed connection guide](stellar-forge/mcp-merchant-operator/FRED.md) for the exact CLI and configured runtime path.

The original **Customer** panel selects an advertised complete file, prepares its retained intent and displays the payment terms before the configured buyer acts. After an interruption, use **Recover** on that same intent and retain its original state. The existing buyer verifies the complete delivered size and hash against the publication before export. Reading this example or downloading this package creates no purchase or payment.

The previously assigned FRED receiving operation, its saved source-only review and its four original buyer intents remain separate from this ready example. This download does not claim their completion. An operator can use this analyst selection as a separate explicitly reviewed publication in that same continuing project.

## Hand over and reopen the whole project

Export from the original application once your project contains the reviewed editions you intend to deliver:

```sh
starforge fred export --project "$FRED_PROJECT" \
  --out /absolute/delivery/economic-project.json
starforge fred receive --project /absolute/private/received-economic-project \
  --source /absolute/delivery/economic-project.json
starforge fred serve --project /absolute/private/received-economic-project \
  --connection-file /absolute/private/received-economic-startup.json
```

The native v2 project bundle keeps the source captures, reviewed selections, complete briefing files and publication identities. Its receiver verifies the original source and all report bytes before reopening. Merchant credentials and signer authority stay with their configured host; the public report package contains neither.
