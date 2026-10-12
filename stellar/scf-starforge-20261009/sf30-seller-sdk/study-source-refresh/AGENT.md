# Study workspace: installed command and Merchant agent interface

The installed command, browser and Merchant tools operate the same Study workspace. The original Python application owns its source records, frozen portfolios and mappings, comparisons, review versions, property surveys, selections and received packages. Original ACS, ACS API, BLS and HUD adapters and existing SF88/SF100 acquisition remain the intake implementations.

## Install and open the original operator

Use a distribution containing this component’s study-source-refresh contribution and the maintained source-owned Merchant provider registry. The installed package is @tokenjunkielabs/starforge-merchant. Its Python command accepts the same arguments as cli.py; select a Python environment with the dependencies documented by the chosen original source provider.

```sh
starforge study-source-refresh --python /usr/bin/python3 --workspace /private/studies/portfolio init
starforge study-source-refresh --python /usr/bin/python3 --workspace /private/studies/portfolio serve --port 0
```

The command prints the original loopback address and private connection-file path. Open that connection through the existing operator flow. For all original command options, run study-source-refresh --help. The complete property API also uses the original generic call command:

```sh
starforge study-source-refresh --python /usr/bin/python3 --workspace /private/studies/portfolio call property.intake --arguments /private/study-inputs/intake-arguments.json
```

See README.md for source intake, portfolio/mapping schemas, edition comparison and original receiving. PROPERTY_RESEARCH.md defines complete property-survey documents, study/PMA identity, comparable decisions, unit cohorts and source-correction review.

## Declare the actual host workspaces and inputs

Create a private connection JSON with the existing workspace directories and exact original input locations. The paths below are illustrative; choose actual host paths. Parent and workspace directories are owned and mode 0700. Connection files are regular, owned and mode 0600. Executable paths are host configuration, rather than tool arguments. An omitted allowStart defaults to borrowing an already-running original operator.

```json
{
  "schema": "stellar-forge.study-workspace-connection.v1",
  "workspaces": {
    "portfolio": {
      "label": "Selected study portfolio",
      "directory": "/private/studies/portfolio",
      "pythonExecutable": "/usr/bin/python3",
      "nodeExecutable": "/usr/bin/node",
      "allowStart": true,
      "inputs": {
        "acs-edition": {
          "kind": "source",
          "provider": "acs",
          "file": "/private/source-captures/acs/source.json"
        },
        "published-survey": {
          "kind": "document",
          "file": "/private/study-inputs/published-survey.pdf"
        },
        "source-scan": {
          "kind": "scan",
          "file": "/private/acquired-source/scan.json"
        }
      },
      "acquisitions": {
        "source-files": {
          "provider": "acs",
          "session": "/private/buyer-sessions/acs-source-files"
        }
      }
    },
    "receiving": {
      "label": "Receiving study operator",
      "directory": "/private/studies/receiving",
      "pythonExecutable": "/usr/bin/python3",
      "nodeExecutable": "/usr/bin/node",
      "allowStart": true
    }
  }
}
```

The workspace aliases are independent saved operators. A configured alias fixes the workspace, application source selection and Python executable. Give each original directory one alias. The receiving alias lets an agent import the complete produced package into a second real operator and reopen it.

File input kinds are source, scan, document, json, package and file. A source input also declares its original provider: acs for a Summary File capture, acs_api for the original Census API source packet, bls or hud. Pin an optional sha256 in host configuration; every input selected for a write also requires its actual current SHA256 in the tool call. Original property documents may be public-source files with ordinary read permissions; each source adapter retains its own file-permission requirements. Retained connections, agent snapshots and receiving state remain private.

Acquisition aliases bind existing original finalized SF88 sessions. Their checkout defaults to the same installed source tree and any explicit checkout must resolve to that tree. The original receiver calls that installed SF88/SF100 implementation, verifies saved data-room bytes and retains the complete source receipt. It preserves the existing acquisition and payment state. A scan input selects an already-finalized SF100 scan and its original saved pages.

## Initialize the original Merchant

Use the maintained source-owned registry; the Study descriptor contributes its own setup hook, metadata, configuration reader and runtime. These commands inspect the installed descriptor and initialize an ordinary Merchant configuration:

```sh
starforge merchant-providers inspect study-workspaces
starforge merchant-providers init study-workspaces --options /private/study-merchant-setup.json
```

```json
{
  "directory": "/private/study-merchant",
  "connection": "/private/study-workspaces.json",
  "name": "Study source and property research"
}
```

Setup creates the original release store, private customer-exports directory and merchant-mcp.json. It validates the complete ordinary Merchant configuration before publishing the new directory. Repeating setup against the exact complete configuration returns REOPENED. An existing directory with different settings is reported for explicit reconciliation. The original Merchant stdio launcher consumes the resulting merchant-mcp.json.

An existing ordinary Merchant can declare studyWorkspaceConnection alongside its existing source-owned provider inputs. The same registry supplies family studyWorkspaces, provider ID study-workspaces, all merchant_study_ tools and their request/lifecycle contract. Adding this component does not require a new central provider branch.

## Complete source and study workflow

Start with merchant_study_workspaces, merchant_study_inputs and merchant_study_inspect. Inspect returns the authenticated original instance when it is running. Use merchant_study_open to attach the chosen instance or to launch its original Python serve command if the host explicitly enabled startup. The optional expectedSelectionSha256 binds the selection shown by workspaces.

Choose one original intake route:

- merchant_study_source_import consumes a declared complete source pointer or source packet and its original provider manifest.
- merchant_study_source_receive_files delivers an existing finalized source-files acquisition through the original provider consumer.
- merchant_study_source_receive_rows joins an acquired observation projection to its identical retained source rows.
- merchant_study_source_receive_scan consumes the declared original finalized SF100 scan. Select either its provider for source files or an existing source_id and projection for observations.

Read merchant_study_catalog and merchant_study_source_rows before selecting the portfolio. Freeze the explicit geography/measure universe with portfolio_freeze and the field keys, export names and decimal unit conversions with mapping_freeze. These accept the original object inline or a verified JSON input. edition_freeze binds the chosen source IDs, portfolio and mapping into one immutable study edition.

Use comparison_create with same_period to identify changed values within the same observation period, or successive_release for an explicitly selected release comparison. Source vintage, observation period and retrieval time remain separate. Read comparison_read and observation_read for original values, uncertainty or disclosure state, units, geography identity and raw source locators. Incomparable and ambiguous rows retain their native review state.

Read the current comparison version, select the exact keys, and call review_apply with expected_version, operator, note and accept or exclude. Source/review changes require rereading that original comparison; an old version cannot silently approve a newer edition. export_create uses the exact accepted review version and produces the original complete mapped package. export_verify checks its inventory, export_archive creates its complete ZIP, and download retains the native archive’s exact bytes.

Select that retained ZIP by snapshotId and sourceWorkspace when calling package_import in the receiving alias. The original receiver preserves source files, original acquisition receipts, mapped CSV/JSONL, reviews, event history and the complete incoming package. Inspect the receiving workspace’s status and reopen its browser through merchant_study_browser. The same produced or received package remains in the original Packages view.

## Complete property-survey and comparable-supply workflow

Retain the exact published PDF, survey workbook or source file with property_document_import and its original metadata. Bind the complete original intake to those document IDs using property_intake. For a large JSON intake, supply a verified input file so the original Python intake reads that complete file. property_study_freeze records the study/PMA and supplied geography identities. The source_url, observation date, survey date, original table/page locators and property/unit keys remain native fields.

Read property_edition_read or property_edition_packet before making a corrected complete edition with property_edition_revise. Create and page the original source-correction comparison, then apply its exact-version review decisions. property_selection_freeze records the staff-selected purpose, reasons, criteria, selected properties and selected unit cohorts. Market-rate and assisted-housing purposes can use different retained selections.

property_selection_read and property_selection_report expose the original selection and analyst tables. property_selection_export produces the full report, CSV tables, transitive survey source and receiving package. Use the same original export/archive/download/verified receiving flow as source study packages. The package retains its frozen review decisions while a receiving operator’s later review remains distinct.

## Full responses, exact file reads and interrupted receiving

Each complete native JSON response is retained before its compact tool presentation. The result carries the native HTTP status, exact instance/source identity, snapshot ID, whole SHA256 and byte count. Arrays appear as JSON pointers with their original counts. Use snapshot for selected nested values, rows for up to 200 original rows and 48,000 row-content bytes, or file_read for the complete original response. A single oversized row gives its exact pointer so nested values or full bytes remain accessible.

file_read uses the maintained shared RetainedFileReads implementation over an already-open original file handle. It reads up to 65,536 bytes at an exact offset, preserves the complete original hash and returns a readId for continuation. Finish with file_release. Native archive downloads stream directly into retained private custody; the original response file is reused by the shared reader.

Incoming documents and ZIPs use one retained payload per transfer. Call receive_begin with a stable transferKey, original filename, total bytes and SHA256. Write fixed 65,536-byte base64 parts with receive_chunk; the last part uses its exact remaining length. Each part is fsynced before its small hash receipt is saved. An identical retry verifies the existing original bytes. receive_status pages missing offsets after interruption. receive_commit verifies all parts, the full original length and SHA256, then makes that input available to the subsequent explicit native import. The native 512 MiB complete-package limit remains in force.

Use a completed transferId as an input for package_import or property_document_import. Files that must retain their adjacent native companions, such as a source pointer and capture manifest, should use a host-declared complete input directory and the original source import route, or arrive inside the complete original receiving package.

Agent result storage is response/transport custody. The original Study SQLite, source manifests, acquisition directories, review version and package inventory remain the business records. If native HTTP completed but local snapshot retention fails, the response reports its known native status, result and retention failure. Recover storage, inspect the original saved IDs and repeat the required read/download to retain it.

## Operator ownership, restart and uncertain writes

The Python service holds a distinct operator.lock for its HTTP lifetime; the existing workspace.lock remains the original per-mutation SQLite lock. The private connection declares a random instance ID, PID, exact workspace/source selection and Python identity. The client authenticates /api/access and rereads the private connection before attaching. It verifies the application source selection again before each native request.

An existing browser/operator is borrowed. Closing that alias releases the client connection and leaves its owner running. A host-approved startup invokes the original cli.py serve command; close drains the alias’s accepted calls and terminates only that exact owned child. A restarted operator has another instance ID and requires an explicit reopen. Authentication, source-selection or instance mismatches are returned for reconciliation.

For selected path inputs, the original native intake verifies expected_input_sha256 against the bytes it actually read or copied before writing any source or property record. Source-pointer verification uses the retained original descriptor, preserving its relative capture paths. CLI import-source and receive-scan expose the same check as --expected-sha256. Host-selected options.environment passes through the provider to the original spawned Python service and its child source readers.

Transport loss after a native mutation is dispatched returns STUDY_RESULT_UNCERTAIN with the original operation and instance identity. The client does not replay that write. Inspect the same original source IDs, edition, comparison, current review version, selection or export to resolve its outcome. Native application refusals that return a complete HTTP body remain known responses and are retained in full.

## Typed local client

Applications that already use the same private operator can import the installed client and configuration reader. The public call interface validates the declared native operation fields and preserves the complete native HTTP response; original Python validation remains authoritative:

```js
import { StudyWorkspaceClient } from '@tokenjunkielabs/starforge-merchant/seller/study-source-refresh';
import { readStudyWorkspaceConfiguration } from '@tokenjunkielabs/starforge-merchant/seller/study-source-refresh/setup';

const config = await readStudyWorkspaceConfiguration('/private/study-workspaces.json');
const client = new StudyWorkspaceClient(config.workspaces.portfolio);
try {
  await client.open();
  const response = await client.call('status');
  // Consume response.value and retain response.bytes/sha256 when needed.
  process.stdout.write(JSON.stringify(response.value) + '\n');
} finally {
  await client.close();
}
```

The package also exports the exact tool metadata and native operation contracts at /seller/study-source-refresh/contracts, and the original provider at /seller/study-source-refresh/merchant. The component contribution declares the Python/UI support files and source-owned Merchant descriptor so installed dispatch selects the same maintained implementation.
