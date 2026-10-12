# OECD leading-indicator analyst and customer workspace

This is a complete source-to-customer application for the OECD’s monthly composite leading indicators. It retains the original provider responses, saves analyst selections as native SDMX project revisions, creates Macrobond customer editions, produces standalone reports, and runs the maintained Stellar merchant and buyer.

The bundled original capture contains **231 observations for seven countries**: Canada, France, Germany, Italy, Japan, the United Kingdom and the United States. It includes the exact dataflow, DSD and all 12 referenced code lists: **15 unchanged responses, 236,642 bytes**. Every member has its original URL, exact byte count, SHA-256 and native acquisition receipt in [sources/bundle.json](sources/bundle.json).

## Create the complete first edition

Use the original equipped Stellar Forge installation with Node 24, Python 3.11 or later and its maintained native Node dependencies. From the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/examples/create-briefing.mjs \
  --project /ABSOLUTE/PRIVATE/OECD_PROJECT
~~~

That command imports every original source file, builds the native selected-country dataset, saves the first customer edition and an editorial handover revision, writes the HTML/JSON/CSV report, exports the complete revised project packet and reopens it in a separate customer workspace. The second revision records the handover notes while preserving every original observation. Both native project revisions and customer editions travel in the packet. It prints the actual saved artifact paths and identities. The project directory may be absent or an empty private directory. Rerunning the same operation adopts its original result.

Open the same project in its browser:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  serve --project /ABSOLUTE/PRIVATE/OECD_PROJECT
~~~

Open the actual URL printed by that running process. The application includes source inspection, country selection, exact calendar windows, analyst notes, native revision selection, publication and rollback through saved editions, original value tables, gap-aware charts, revision comparison, standalone report downloads and full project import/export.

The **Applications** catalog also exposes **OECD analyst and customer workspace**. The installed contribution forwards the complete **oecd** command family through the existing distribution. Its project binding checks the actual private manifest and catalog directory when reopening.

## Source, report and customer scope

The exact retained dataflow is **OECD.SDD.STES:DSD_STES@DF_CLI(4.1)**. Its native metadata references **OECD.SDD.STES:DSD_STES(4.1)**. The selected basis is:

| Component | Original code |
| --- | --- |
| Frequency | M |
| Measure | LI |
| Unit of measure | IX |
| Activity | _Z |
| Adjustment | AA |
| Transformation | IX |
| Time horizon | _Z |
| Methodology | H |

The report resolves the provider’s retained labels from those exact referenced code lists. It keeps the original source value strings, status, declared decimals, unit multiplier, dimensions and action. SDMX DECIMALS controls the provider’s declared presentation precision; this application keeps the additional original decimal digits in the actual response.

The report window selects the observations shown in the briefing. The native customer edition preserves **all captured observations for the same selected country series**, making the original continuous source available to the customer. Both counts are displayed. A missing source value stays missing; a calendar gap breaks the plotted line. Charts use numeric coordinates for display; the tables and JSON/CSV retain the original exact values.

The same-period country table chooses the latest month with a numeric observation in every selected series. One-, three- and twelve-month changes use exact monthly calendar positions and Decimal differences in index points. A missing comparison month produces an empty change. These are derived report calculations.

The OECD describes the amplitude-adjusted CLI as a qualitative indication of turning points around long-term economic potential, with a long-term average of 100. It is not a quantitative GDP growth-rate forecast. The original [indicator definition](https://www.oecd.org/en/data/indicators/composite-leading-indicator-cli.html) and [methodology/revision explanation](https://www.oecd.org/en/data/insights/data-explainers/2024/04/composite-leading-indicators-frequently-asked-questions.html) are linked inside every report. The two explanatory pages describe different lead-time conventions; the application does not manufacture a lead-time forecast.

## Retain a later source revision

In the browser, select an existing capture and choose **Acquire current observations**. The request uses that capture’s exact flow version and country set with the retained metadata. It makes one original HTTPS GET and preserves the response bytes, actual status/headers, acquisition times, completeness and error result before importing. A repeated completed operation reuses its original response.

The CLI equivalent accepts a complete JSON request:

~~~json
{
  "operation_id": "YOUR_NEXT_ORIGINAL_READ_ID",
  "capture_id": "THE_EXISTING_CAPTURE_SHA256",
  "start_period": "2024-01",
  "end_period": null
}
~~~

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  refresh --project /ABSOLUTE/PRIVATE/OECD_PROJECT --request refresh.json
~~~

Then choose the existing analyst source project and its current revision when saving the next briefing. The browser and API require that actual revision. The original SDMX workspace records the new immutable revision and retains the previous source; the original Macrobond catalog creates the corresponding customer edition.

**Compare saved editions** shows added, revised and absent original observations in the two report selections alongside the full native catalog comparison. That native comparison retains acquisition scope, selection equivalence and source actions. An absent observation in a narrower response remains scoped to that response.

To import another complete source acquisition, use **capture --manifest PATH** with a source-bundle manifest and its original adjacent XML files. The HTTP and MCP capture methods accept the same member declarations with exact base64 bytes. The application resolves the selected native dataflow through its DSD and referenced code lists before accepting a capture.

## Native merchant and buyer receiving

[examples/receiving.json](examples/receiving.json) is the complete receiving configuration template. Bind these fields to the original equipped operator’s existing resources:

- **merchant.paymentFile**: the actual public payment terms already accepted by the maintained seller.
- **merchant.directory**, **stateDirectory**, **origin**, **path** and **port**: the selected original merchant release and state.
- **buyer.configFile**, **operatorWorkspace** and **id**: the original configured buyer account, signer/reservation policy and retained dataset operation.
- **buyer.maxTotalAtomic**: the total authorized amount in the actual accepted asset’s atomic units; derive it from the original live terms.
- The original facilitator setting, when the existing merchant requires an explicit one.

The bundled 231-row edition with **pageSize 150** needs two native data pages. **maxPages 2** is the exact template limit for that source selection. The configured existing buyer retains its original per-page payment intents and accounting ledger.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  receive --project /ABSOLUTE/PRIVATE/OECD_PROJECT \
  --config /ABSOLUTE/PRIVATE/ORIGINAL_RECEIVING_CONFIG.json
~~~

The receiver performs the complete operation:

1. Import the original capture and save its full analyst/native customer edition.
2. Retain all three report artifacts and materialize the original SDMX dataset/lineage.
3. Prepare the maintained merchant release and select the customer publication.
4. Start the configured native merchant, inspect its actual offer and prepare the original SF88 buyer selection.
5. Run or continue the same buyer dataset, drain original accounting through **Dataset.finalizeAll**, and deliver the complete native dataset.
6. Compare every delivered original series, month, value, presence, action, attribute and dimension against the original catalog observations.
7. Include the complete original project packet and report files in that native delivery and reopen the original DatasetDelivery.
8. Save an editorial handover revision on the same source project, retaining the original observations, and add its report files and complete revised packet to the delivery.
9. Import that revised packet directly into a separate named customer workspace, compare every report byte and original source row, and retain the actual workspace and browser command.
10. Read the same published Macrobond provider and retain its actual outputs.

The checkpoint is **PROJECT/receiving/OPERATION/receiving.json**. The operation binds its actual configuration, public payment-file SHA, original buyer configuration SHA, release, snapshot, dataset session, native process results and accounting pages. Repeating the command continues those retained steps. A running native buyer attempt stays with that actual session. The receiver never creates another signer or writes accounting records outside the maintained buyer.

The complete standalone report is in **PROJECT/reports/BRIEFING_ID/** and is copied into the buyer delivery. Open **briefing.html** directly for an offline report, or run **serve** on the same project for the interactive application. The saved project ZIP includes the original customer catalog/source packet, the report files and their identities. Import reconstructs the report through the maintained engine and requires exact matching bytes. It verifies the original imported source operation and customer-edition request before restoring the corresponding OECD operation. A revised packet therefore reopens in a new workspace even though its native imported project history has already advanced beyond the original pre-save revision. New analyst writes still require the current native revision.

The receiver's separate customer workspace is **PROJECT/receiving/OPERATION/reopened-customer-project/**. Its complete editorial report and packet are retained under **buyer-delivery/revised-briefing/**. The source-only example creates **PROJECT/reopened-customer-project/**. The returned browser command opens that actual retained customer project.

## Operator CLI and typed client

All Python project commands are available through the installed Node CLI:

| Command | Complete operation |
| --- | --- |
| init / status | Create or inspect the original private project |
| seed / capture / refresh | Retain bundled, supplied or newly acquired original sources |
| preview / save / briefing | Review, save and read analyst/customer editions |
| compare / activate | Compare native editions and select publication or rollback |
| export-dataset | Materialize native merchant CSV, configuration and lineage |
| export-customer / export-project / import | Export and reopen the complete original customer/project state |
| serve | Open the industrial browser and existing provider |
| receive | Run the configured original merchant/buyer/report operation |
| mcp | Serve the same retained application through MCP stdio |

Use **--request FILE** for structured operation JSON, or **--request -** to read stdin. Export commands accept **--id BRIEFING_ID**; import accepts **--packet FILE**. **--python COMMAND** selects the existing Python interpreter. Source changes go through the retained project request and its expected revision.

The [typed client](client.d.ts) includes complete source, selection, report, customer, publication, provider and download interfaces. Its **launchOecd** function starts the real Python server and returns that process’s actual project ID, private console URL and local client. **createOecdClient** and **readOecdConnection** attach to an existing original process. A connection file is created with **serve --connection-file PRIVATE_FILE**; keep it with the existing private operator state.

~~~js
import { launchOecd } from './client.mjs';

const app = await launchOecd({
  projectDirectory: '/ABSOLUTE/PRIVATE/OECD_PROJECT',
  env: { ...process.env, SF30_XML_NODE: process.execPath }
});
try {
  const state = await app.client.state();
  const report = await app.client.briefing(state.briefings[0].id);
  const rows = await app.client.sourceRows(report.id);
  console.log(report.document.common_period, rows.row_count);
} finally {
  await app.close();
}
~~~

The client supports loopback origins, an explicit original process capability, finite deadlines and bounded response reads. It preserves unsuccessful HTTP response bytes on the thrown error. It makes one request per method.

## MCP

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  mcp --project /ABSOLUTE/PRIVATE/OECD_PROJECT
~~~

Use **--connection-file PRIVATE_FILE** to bind the MCP connection to an already running original operator. Otherwise it owns the one server it launches and closes it when stdin ends.

The 17 tools cover **state, connection, seed, capture, refresh, preview, save, briefing, source_rows, compare, activate, export_dataset, export_customer, export_project, report_file, import_project, provider**. They use complete JSON schemas and the same model methods as the browser. Export tools save full private artifacts to the supplied destination. Operation IDs and publication revisions carry through unchanged.

## Original Macrobond provider

Launch with the names of the existing username and password environment variables:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  serve --project /ABSOLUTE/PRIVATE/OECD_PROJECT \
  --provider-username-env EXISTING_PROVIDER_USERNAME \
  --provider-password-env EXISTING_PROVIDER_PASSWORD
~~~

Publish a saved briefing in the browser. The maintained provider exposes its original capability, metadata, series search/list, tree and multi-series methods. Download the native connection XML from the application. The original catalog retains decimal values, supported calendar anchors, current publication and rollback history; this application supplies the source-declared UNIT_MEASURE code when the series declares its unit as a dimension.

## Source composition

This application composes the existing **sdmx_source.py**, **sdmx_workspace.py**, **macrobond/catalog.py**, **macrobond/server.py**, **merchant.mjs**, **customer.mjs** and SF88/SF100 buyer/delivery modules.

The shared source compatibility changes preserve the actual **Header/StructureUsage** dataflow reference kind, resolve it against the selected original dataflow and its exact DSD, and recover that kind from older workspaces’ retained complete Header. Direct DSD references retain their original behavior. The catalog unit display uses the original UNIT attribute where supplied and the source-declared UNIT_MEASURE dimension otherwise. Original native CSV columns and snapshot contracts remain governed by the maintained workspace.

The new application code uses MIT, as do the maintained SDMX components. OECD and referenced SDMX source responses retain their provider terms and original attribution; their filenames and hashes are listed separately in the source manifest. See [SOURCE.md](SOURCE.md) for the complete source acquisition and methodology links.
